#!/bin/bash
# Start the Next.js dev server in the background, detached from this shell.
cd /home/z/my-project
setsid ./node_modules/.bin/next dev -p 3000 > dev.log 2>&1 < /dev/null &
disown
echo "Started next dev, PID $!"
