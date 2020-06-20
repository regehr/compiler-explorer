#!/bin/bash

cd /home/ce/compiler-explorer

while :
do
	sleep 30
	sudo -u ce NODE_ENV=production /home/ce/node-v12.18.0-linux-x64/bin/node app.js
done
