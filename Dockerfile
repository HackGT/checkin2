FROM node:8-alpine
MAINTAINER Ryan Petschek <petschekr@gmail.com>

# Install latest npm version (in case Node.js hasn't updated with the newest version yet)
# npm install -g npm@latest doesn't work -> see https://github.com/npm/npm/issues/15611#issuecomment-289133810 for this hack
RUN npm install npm@"~5.4.0" && rm -rf /usr/local/lib/node_modules && mv node_modules /usr/local/lib

RUN mkdir -p /usr/src/checkin
WORKDIR /usr/src/checkin

# Bundle app source
COPY . /usr/src/checkin
RUN npm install
RUN npm run build
#RUN npm test

CMD ["npm", "start"]
