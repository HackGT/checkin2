FROM node:alpine
MAINTAINER Ryan Petschek <petschekr@gmail.com>

RUN mkdir -p /usr/src/checkin
WORKDIR /usr/src/checkin

# Bundle app source
COPY . /usr/src/checkin
WORKDIR /usr/src/checkin/server
RUN npm install

WORKDIR /usr/src/checkin
RUN npm install -g typescript
RUN tsc

WORKDIR /usr/src/checkin/server
CMD ["npm", "start"]
