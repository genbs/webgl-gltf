const path = require('path');
const ESLintPlugin = require('eslint-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
    entry: './example/src/app.ts',
    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
        modules: [
            path.resolve('./src'),
            path.resolve('./node_modules'),
        ],
    },
    devtool: 'source-map',
    module: {
        rules: [{
            test: /\.ts$/,
            include: [path.resolve('./example'), path.resolve('./src')],
            use: [{ loader: 'ts-loader' }]
        }
    ]},
    output: {
        path: __dirname + '/example/dist',
        publicPath: '/',
        filename: 'bundle.[hash].js',
    },
    plugins: [
        new CleanWebpackPlugin(),
        new ESLintPlugin({
            extensions: ['.ts'],
        }),
        new HtmlWebpackPlugin({ template: './example/index.html' }),
    ],
    devServer: {
        port: 8080,
        static: {
            directory: path.join(__dirname, 'example/static'),
        },
    },
}
