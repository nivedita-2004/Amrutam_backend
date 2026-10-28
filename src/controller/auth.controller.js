const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authQuery = require('../query/auth.query');
const refreshTokenQuery = require('../query/refreshToken.query');
const auditQuery = require('../query/audit.query');
const { pool } = require('../config/db');

const cookieOptions = (maxAgeMs) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: maxAgeMs
});

/**
 * Generates an access token (~7m) and a refresh token (15d).
 * Embeds familyId and tokenType to ensure proper token lifecycle and reuse detection.
 */
const generateTokens = (user, secret, familyId = crypto.randomUUID()) => {
  const accessPayload = {
    id: user.id,
    role: user.role,
    tokenType: 'access'
  };

  const refreshPayload = {
    id: user.id,
    role: user.role,
    tokenType: 'refresh',
    familyId,
    jti: crypto.randomUUID()
  };

  const accessExpiry = process.env.ACCESS_TOKEN_EXPIRES_IN || '7m';
  const refreshExpiry = process.env.REFRESH_TOKEN_EXPIRES_IN || '15d';

  const accessToken = jwt.sign(accessPayload, secret, { expiresIn: accessExpiry });
  const refreshToken = jwt.sign(refreshPayload, secret, { expiresIn: refreshExpiry });

  return { accessToken, refreshToken, familyId };
};

const signup = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    if (role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Admin accounts cannot be self-registered'
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        message: 'JWT_SECRET is not configured on the server'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await authQuery.findUserByEmail(normalizedEmail);
    if (existingUser) {
      await auditQuery.recordAuditLog({
        actorUserId: null,
        action: 'AUTH_SIGNUP_FAILED',
        entityType: 'auth',
        entityId: null,
        requestId: req.id,
        metadata: { email: normalizedEmail, reason: 'duplicate_email', ip: req.ip }
      });

      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await authQuery.createUser({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: role || 'patient',
      specialization: req.body.specialization,
      qualification: req.body.qualification
    });

    const familyId = crypto.randomUUID();
    const { accessToken, refreshToken } = generateTokens(newUser, secret, familyId);

    // Persist SHA-256 hash of the refresh token (never raw token)
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

    await refreshTokenQuery.createRefreshTokenRecord({
      userId: newUser.id,
      familyId,
      tokenHash,
      expiresAt
    });

    // Audit log successful registration
    await auditQuery.recordAuditLog({
      actorUserId: newUser.id,
      action: 'AUTH_SIGNUP_SUCCESS',
      entityType: 'user',
      entityId: newUser.id,
      requestId: req.id,
      metadata: { role: newUser.role, ip: req.ip }
    });

    res.cookie('accessToken', accessToken, cookieOptions(7 * 60 * 1000));
    res.cookie('refreshToken', refreshToken, cookieOptions(15 * 24 * 60 * 60 * 1000));

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          status: newUser.status,
          created_at: newUser.created_at
        }
      }
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists'
      });
    }
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await authQuery.findUserByEmail(normalizedEmail);
    if (!user) {
      await auditQuery.recordAuditLog({
        actorUserId: null,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'auth',
        entityId: null,
        requestId: req.id,
        metadata: { email: normalizedEmail, reason: 'user_not_found', ip: req.ip }
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await auditQuery.recordAuditLog({
        actorUserId: null,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'auth',
        entityId: null,
        requestId: req.id,
        metadata: { email: normalizedEmail, reason: 'invalid_password', ip: req.ip }
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    if (user.status !== 'active') {
      await auditQuery.recordAuditLog({
        actorUserId: user.id,
        action: 'AUTH_ACCOUNT_SUSPENDED_ATTEMPT',
        entityType: 'user',
        entityId: user.id,
        requestId: req.id,
        metadata: { status: user.status, email: normalizedEmail, ip: req.ip }
      });

      return res.status(403).json({
        success: false,
        message: 'Your account is currently inactive or suspended. Please contact support.'
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        message: 'JWT_SECRET is not configured on the server'
      });
    }

    const familyId = crypto.randomUUID();
    const { accessToken, refreshToken } = generateTokens(user, secret, familyId);

    // Persist SHA-256 hash of refresh token
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

    await refreshTokenQuery.createRefreshTokenRecord({
      userId: user.id,
      familyId,
      tokenHash,
      expiresAt
    });

    // Audit log successful authentication
    await auditQuery.recordAuditLog({
      actorUserId: user.id,
      action: 'AUTH_LOGIN_SUCCESS',
      entityType: 'user',
      entityId: user.id,
      requestId: req.id,
      metadata: { role: user.role, ip: req.ip }
    });

    res.cookie('accessToken', accessToken, cookieOptions(7 * 60 * 1000));
    res.cookie('refreshToken', refreshToken, cookieOptions(15 * 24 * 60 * 60 * 1000));

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Handles atomic refresh-token rotation with automatic reuse detection.
 * If an already-rotated or revoked token is reused, revokes the entire token family.
 */
const refresh = async (req, res, next) => {
  let client;
  try {
    const rawRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!rawRefreshToken) {
      await auditQuery.recordAuditLog({
        actorUserId: null,
        action: 'AUTH_REFRESH_FAILED',
        entityType: 'auth',
        entityId: null,
        requestId: req.id,
        metadata: { reason: 'missing_token', ip: req.ip }
      });

      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        message: 'JWT_SECRET is not configured on the server'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(rawRefreshToken, secret);
    } catch (jwtErr) {
      await auditQuery.recordAuditLog({
        actorUserId: null,
        action: 'AUTH_REFRESH_FAILED',
        entityType: 'auth',
        entityId: null,
        requestId: req.id,
        metadata: { reason: jwtErr.name, ip: req.ip }
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    if (decoded.tokenType !== 'refresh') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type for refresh endpoint'
      });
    }

    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    // Begin atomic transaction with row locking
    client = await pool.connect();
    await client.query('BEGIN');

    const tokenRecord = await refreshTokenQuery.findTokenByHashForUpdate(tokenHash, client);

    if (!tokenRecord) {
      await client.query('ROLLBACK');
      await auditQuery.recordAuditLog({
        actorUserId: decoded.id || null,
        action: 'AUTH_REFRESH_FAILED',
        entityType: 'auth',
        entityId: null,
        requestId: req.id,
        metadata: { reason: 'unknown_token_hash', ip: req.ip }
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid or unrecognized refresh token'
      });
    }

    // REUSE DETECTION: If token is already revoked, terminate the whole family!
    if (tokenRecord.is_revoked) {
      await refreshTokenQuery.revokeFamily(tokenRecord.family_id, client);

      await auditQuery.createAuditLog(
        {
          actorUserId: tokenRecord.user_id,
          action: 'AUTH_REFRESH_REUSE_DETECTED',
          entityType: 'refresh_token',
          entityId: tokenRecord.id,
          requestId: req.id,
          metadata: {
            familyId: tokenRecord.family_id,
            revokedAt: tokenRecord.revoked_at,
            ip: req.ip
          }
        },
        client
      );

      await client.query('COMMIT');

      // Clear cookies for security
      res.clearCookie('accessToken', cookieOptions(0));
      res.clearCookie('refreshToken', cookieOptions(0));

      return res.status(403).json({
        success: false,
        message: 'Refresh token reuse detected. All sessions in this family have been terminated for security. Please log in again.'
      });
    }

    // Check expiration against database record
    if (new Date(tokenRecord.expires_at) < new Date()) {
      await client.query(
        'UPDATE refresh_tokens SET is_revoked = true, revoked_at = CURRENT_TIMESTAMP WHERE id = $1',
        [tokenRecord.id]
      );
      await client.query('COMMIT');

      return res.status(401).json({
        success: false,
        message: 'Refresh token has expired. Please log in again.'
      });
    }

    // Verify user is still active
    const userRes = await client.query(
      'SELECT id, name, email, role, status FROM users WHERE id = $1',
      [tokenRecord.user_id]
    );
    const user = userRes.rows[0];

    if (!user || user.status !== 'active') {
      await refreshTokenQuery.revokeFamily(tokenRecord.family_id, client);
      await auditQuery.createAuditLog(
        {
          actorUserId: tokenRecord.user_id,
          action: 'AUTH_ACCOUNT_SUSPENDED_ATTEMPT',
          entityType: 'user',
          entityId: tokenRecord.user_id,
          requestId: req.id,
          metadata: { reason: 'refresh_attempt_on_suspended_account', ip: req.ip }
        },
        client
      );
      await client.query('COMMIT');

      res.clearCookie('accessToken', cookieOptions(0));
      res.clearCookie('refreshToken', cookieOptions(0));

      return res.status(403).json({
        success: false,
        message: 'Your account is inactive or suspended. Please contact support.'
      });
    }

    // Issue rotated replacement tokens with the same familyId
    const newAccessToken = jwt.sign(
      { id: user.id, role: user.role, tokenType: 'access' },
      secret,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '7m' }
    );

    const newRefreshToken = jwt.sign(
      { id: user.id, role: user.role, tokenType: 'refresh', familyId: tokenRecord.family_id, jti: crypto.randomUUID() },
      secret,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '15d' }
    );

    const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    const newExpiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

    // Atomically rotate: mark old token as replaced, insert new token
    await refreshTokenQuery.rotateTokenRecord(tokenRecord.id, newTokenHash, client);

    const insertRes = await client.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id;`,
      [user.id, tokenRecord.family_id, newTokenHash, newExpiresAt]
    );

    // Atomically record audit log
    await auditQuery.createAuditLog(
      {
        actorUserId: user.id,
        action: 'AUTH_REFRESH_SUCCESS',
        entityType: 'refresh_token',
        entityId: insertRes.rows[0].id,
        requestId: req.id,
        metadata: { familyId: tokenRecord.family_id, ip: req.ip }
      },
      client
    );

    await client.query('COMMIT');

    // Update client cookies
    res.cookie('accessToken', newAccessToken, cookieOptions(7 * 60 * 1000));
    res.cookie('refreshToken', newRefreshToken, cookieOptions(15 * 24 * 60 * 60 * 1000));

    res.status(200).json({
      success: true,
      message: 'Tokens refreshed successfully',
      data: {
        user: {
          id: user.id,
          role: user.role
        }
      }
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // ignore rollback errors
      }
    }
    next(err);
  } finally {
    if (client) {
      client.release();
    }
  }
};

const logout = async (req, res, next) => {
  try {
    const rawRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (rawRefreshToken) {
      try {
        const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
        await refreshTokenQuery.revokeTokenByHash(tokenHash);
      } catch (hashErr) {
        // ignore malformed token on logout
      }
    }

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
    };

    res.clearCookie('accessToken', options);
    res.clearCookie('refreshToken', options);

    await auditQuery.recordAuditLog({
      actorUserId: req.user?.id || null,
      action: 'AUTH_LOGOUT_SUCCESS',
      entityType: 'user',
      entityId: req.user?.id || null,
      requestId: req.id,
      metadata: { ip: req.ip }
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (err) {
    next(err);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await authQuery.findUserWithProfileById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User account no longer exists'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          created_at: user.created_at,
          profile: {
            phone: user.phone,
            date_of_birth: user.date_of_birth,
            gender: user.gender,
            address: user.address,
            emergency_contact: user.emergency_contact
          }
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  signup,
  login,
  refresh,
  logout,
  getMe,
  register: signup
};
