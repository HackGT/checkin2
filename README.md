# Checkin

<a href="https://zenhub.com"><img src="https://raw.githubusercontent.com/ZenHubIO/support/master/zenhub-badge.png"></a>

**Simple, robust, and mobile-friendly check in system for hackathons and other events. Capable of handling many concurrent events and displaying updates in real-time.**

Originally designed and built for HackGT events.

![Check in](https://i.imgur.com/swDTnGI.png)

## Usage
The check in interface is divided into several sections that can be switched between from the flyout side menu:

- Main check in interface (*shown above*)
- Choose check in tag (*integrated into the menu*)
- Import users
- Delete check in tag (*integrated into the menu*)
- Manage and configure users

Check in status is kept synchronized across multiple open instances in real-time using WebSockets.

## Installation and Deployment
A [Dockerfile](Dockerfile) is provided for convenience.

    npm install # Install required dependencies
    npm run build # Compile
    npm test # Optional: run tests
    npm start

Environment Variable | Description
---------------------|------------
PORT | The port the check in system should run on (default: `3000`)
MONGO_URL | The URL to the MongoDB server including the database (default: `mongodb://localhost/checkin`)

On first start up, the server will automatically generate a default user with which to log in and add users and print the credentials to STOUT. **Make sure to delete this user or change its password from the default once you are done.**

Because the server is not configured to serve over HTTPS, you'll want to set up some kind of reverse-proxy server like [Nginx](http://nginx.org/) in production.

## Testing
This project is using [Mocha](https://mochajs.org/) for unit testing. Currently, the tests only cover the server and the API.

The unit tests require a locally running MongoDB server. The tests are designed to and *should* leave the database unaffected after completion and succeed even with the presence of existing data. Please file a new issue if this behavior is not observed. Running on an production database is still strongly discouraged, however.

To run the tests (from the project's root directory):

    npm install # Install required dependencies (including development dependencies)
    npm install -g typescript # Install the TypeScript compiler
    npm test # Compile and run the unit tests

If adding or changing API endpoints (see the [Contributing](#contributing) section below), please write new tests or edit existing tests to retain 100% coverage.

## Contributing
Development is organized using [Git Flow](http://nvie.com/posts/a-successful-git-branching-model/). All development work should occur on the `develop` branch and merged into `master` and tagged with the version  when production ready. Only ready-to-ship code should be merged into the `master` branch.

Try to follow existing coding styles and conventions. For example, use TypeScript's [type annotations](http://www.typescriptlang.org/docs/handbook/basic-types.html) whenever possible and Promises for asyncronous operations in conjunction with ES7 async/await (TypeScript's transpilation allows for the use of these features even on platforms that don't support or entirely support ES6 and ES7).

[Strict null-checking](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-0.html) is enabled in the `tsconfig.json` which might make some vanilla JavaScript code fail to compile unless minor changes are made.

## License
Copyright &copy; 2017 HackGT. Released under the MIT license. See [LICENSE](LICENSE) for more information.
