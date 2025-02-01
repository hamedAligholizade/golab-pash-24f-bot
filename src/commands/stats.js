const queries = require('../database/queries');
const { adminAuth } = require('../middlewares/auth');

const statsHandler = async (msg, bot) => {
  if (!adminAuth(msg, bot)) return;

  try {
    const stats = await queries.getStats();
    const message = formatStats(stats);
    await bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Error getting stats:', error);
    await bot.sendMessage(msg.chat.id, 'Error getting statistics.');
  }
};

function formatStats(stats) {
  const totalUsers = stats[0]?.total_users || 0;
  const totalBots = stats[0]?.total_bots || 0;

  let message = `<b>Bot Statistics</b>\n\n`;
  message += `Total Users: ${totalUsers}\n`;
  message += `Total Bots: ${totalBots}\n\n`;
  message += `<b>Users per day:</b>\n`;

  stats.forEach(row => {
    const date = new Date(row.date).toLocaleDateString();
    message += `${date}: ${row.users_per_day} users\n`;
  });

  return message;
}

module.exports = { statsHandler }; 