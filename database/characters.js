// Demo game data only. Never infer characters from historical order input.
export const demoCharacters = [
  ['player_one', 'player.one@example.test', 'star_1', '星海先锋'],
  ['player_one', 'player.one@example.test', 'dusk_2', '暮光游侠'],
  ['player_two', 'player.two@example.test', 'star_1', '星海守望'],
];

export async function seedDemoCharacters(connection) {
  for (const [username, email, server, name] of demoCharacters) {
    await connection.execute(`INSERT INTO game_characters (user_id, server, character_name)
      SELECT id, ?, ? FROM users WHERE username = ? AND email = ? AND role = 'user'
      ON DUPLICATE KEY UPDATE id = game_characters.id`, [server, name, username, email]);
  }
}
