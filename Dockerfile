FROM node:alpine
MAINTAINER Ryan Petschek <petschekr@gmail.com>

RUN mkdir -p /usr/src/checkin
WORKDIR /usr/src/checkin

# Bundle app source
COPY . /usr/src/checkin
WORKDIR server
RUN npm install
EXPOSE 3000

WORKDIR ../
RUN npm install -g typescript
RUN tsc

WORKDIR server
# Set this to the name of the linked MongoDB container
ENV db="checkin-db"
CMD [ "npm", "start" ]