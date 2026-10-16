PYTHON := $(shell if [ -f .venv/bin/python ]; then echo .venv/bin/python; else echo python3; fi)

.PHONY: setup api worker web test web-build dev

setup:
	$(PYTHON) -m pip install -e "api[dev]"
	npm install --prefix web

api:
	cd api && ../$(PYTHON) -m uvicorn saathi.main:app --reload --host 127.0.0.1 --port 8080 --app-dir src

worker:
	cd api && ../$(PYTHON) -m uvicorn saathi.worker:app --reload --host 127.0.0.1 --port 8081 --app-dir src

web:
	npm run dev --prefix web

test:
	$(PYTHON) -m pytest api/tests

web-build:
	npm run build --prefix web

