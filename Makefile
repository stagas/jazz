dev:
	@live-server --no-browser

devs:
	@live-server

todo:
	@grep --color=always -nd recurse TODO lib src xoor.js

test:
	@xdg-open http://localhost:8080/test/

#fetch:
#	@wget -P deps -nc -i Lib

.PHONY: dev devs todo test
