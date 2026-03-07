module.exports = {
  apps: [
    {
      name: 'myblog-server',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
