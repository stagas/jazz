dev:
	@make dev-build & \
		./node_modules/.bin/live-server \
		--no-browser \
		--port=3000 \
		--wait=200 \
		--watch=dist/jazz.js,examples

dev-build:
	@./node_modules/.bin/watchify \
		--plugin [ css-modulesify -o dist/jazz.css ] \
		--verbose \
		--detect-globals=false \
		--standalone Jazz \
		--node \
		--debug \
		--entry index.js \
		--outfile dist/jazz.js

install: package.json
	@npm install

todo:
	@grep -A 1 --color=always -nd recurse TODO lib src index.js

test:
	@./node_modules/.bin/live-server \
		--open=test \
		--wait=100 \
		--watch=lib,src,test

.PHONY: dev dev-build todo test
