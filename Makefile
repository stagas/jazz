build:
	@NODE_PATH=lib \
		watchify \
		--verbose \
		--detect-globals=false \
		--standalone Jazz \
		--node \
		--debug \
		--entry jazz.js \
		--outfile dist/jazz.js

dev:
	@live-server --no-browser

devs:
	@live-server

todo:
	@grep --color=always -nd recurse TODO lib src jazz.js

test:
	@xdg-open http://localhost:8080/test/

#fetch:
#	@wget -P deps -nc -i Lib

.PHONY: dev devs todo test
