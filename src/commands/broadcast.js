const queries = require('../database/queries');
const { adminAuth } = require('../middlewares/auth');

const broadcastHandler = async (msg, bot) => {
  if (!adminAuth(msg, bot)) return;

  const messageText = msg.text.split('/broadcast ')[1];
  if (!messageText) {
    await bot.sendMessage(msg.chat.id, 'Please provide a message to broadcast.\nUsage: /broadcast <message>');
    return;
  }

  try {
    const users = await queries.getAllUsers();
    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      try {
        await bot.sendMessage(user.user_id, messageText);
        successCount++;
      } catch (error) {
        failCount++;
        console.error(`Failed to send message to user ${user.user_id}:`, error);
      }
      // Add delay to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    await bot.sendMessage(
      msg.chat.id,
      `Broadcast completed!\nSuccess: ${successCount}\nFailed: ${failCount}`
    );
  } catch (error) {
    console.error('Error broadcasting message:', error);
    await bot.sendMessage(msg.chat.id, 'Error broadcasting message.');
  }
};

module.exports = { broadcastHandler }; 