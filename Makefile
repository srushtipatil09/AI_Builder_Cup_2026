.PHONY: setup api web test lint dev

setup:
	python -m pip install -e "api[dev]"
	npm install --prefix web

api:
	cd api && python -m uvicorn saathi.main:app --reload --host 127.0.0.1 --port 8080 --app-dir src

worker:
	cd api && python -m uvicorn saathi.worker:app --reload --host 127.0.0.1 --port 8081 --app-dir src

web:
	npm run dev --prefix web

test:
	python -m pytest api/tests

web-build:
	npm run build --prefix web
