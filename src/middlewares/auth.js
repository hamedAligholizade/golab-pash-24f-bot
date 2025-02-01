const config = require('../config/config');

const adminAuth = (msg, bot) => {
  const userId = msg.from.id.toString();
  if (userId !== config.adminUserId) {
    bot.sendMessage(msg.chat.id, 'Unauthorized: This command is only available for admins.');
    return false;
  }
  return true;
};

module.exports = { adminAuth }; 