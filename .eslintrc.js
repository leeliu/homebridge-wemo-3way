module.exports = {
  root: true,
  env: {
    node: true,
    es6: true
  },
  extends: ['plugin:prettier/recommended', 'eslint:recommended'],
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off'
  }
}
