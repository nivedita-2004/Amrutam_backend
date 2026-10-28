const userQuery = require('../query/user.query');

const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const profile = await userQuery.getUserProfile(userId);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { profile }
    });
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const updated = await userQuery.upsertUserProfile(userId, req.body);

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: { profile: updated }
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

module.exports = {
  getProfile,
  updateProfile
};
