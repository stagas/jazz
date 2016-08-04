dev:
	@live-server --no-browser

devs:
	@live-server

test:
	@xdg-open http://localhost:8080/test/

#fetch:
#	@wget -P deps -nc -i Lib

.PHONY: dev devs test fetch
