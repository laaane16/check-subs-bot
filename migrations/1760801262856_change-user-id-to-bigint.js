/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;


/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.alterColumn('users', 'user_id', {
    type: 'bigint',
    using: 'user_id::bigint', // преобразование текущих значений
  });
};
