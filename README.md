# Ultimate Checkin
Simple, robust, and mobile-friendly check in system for hackathons and other events. Capable of handling many concurrent events and displaying updates in real-time.

Originally designed and built for HackGT events.

## Usage


## Installation and Deployment
A [Dockerfile](Dockerfile) is provided for convenience.

    npm install # Install required dependencies
    npm install -g typescript # Install the TypeScript compiler
    tsc # Compile
    npm start

Environment Variable | Description
---------------------|------------
PORT | The port the check in system should run on (default: `3000`)
MONGO_URL | The URL to the MongoDB server (default: `mongodb://localhost/`)
UNIQUE_APP_ID | The MongoDB database name to store data in (default: `ultimate-checkin`)

On first start up, the server will automatically generate a default user with which to log in and add users and print the credentials to STOUT. **Make sure to delete this user or change its password from the default once you are done.**

Because the server is not configured to serve over HTTPS, you'll want to set up some kind of reverse-proxy server like [Nginx](http://nginx.org/) in production.

## Contributing
Development is organized using [Git Flow](http://nvie.com/posts/a-successful-git-branching-model/). All development work should occur on the `develop` branch and merged into `master` and tagged with the version  when production ready. Only ready-to-ship code should be merged into the `master` branch.

Try to follow existing coding styles and conventions. For example, use TypeScript's [type annotations](http://www.typescriptlang.org/docs/handbook/basic-types.html) whenever possible and Promises for asyncronous operations in conjunction with ES7 async/await (TypeScript's transpilation allows for the use of these features even on platforms that don't support or entirely support ES6 and ES7).

[Strict null-checking](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-0.html) is enabled in the `tsconfig.json` which may require some vanilla JavaScript code to fail to compile unless minor changes are made.

## License
Copyright &copy; 2017 HackGT. Released under the MIT license. See [LICENSE](LICENSE) for more information.
