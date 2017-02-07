FROM node:alpine
MAINTAINER Ryan Petschek <petschekr@gmail.com>

RUN mkdir -p /usr/src/checkin
WORKDIR /usr/src/checkin

# Bundle app source
COPY . /usr/src/checkin
RUN npm install
RUN npm install -g typescript
RUN tsc
CMD ["npm", "start"]
