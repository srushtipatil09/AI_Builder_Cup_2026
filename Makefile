PYTHON := $(shell if [ -f .venv/bin/python ]; then echo .venv/bin/python; else echo python3; fi)

.PHONY: setup api worker web test web-build lint check eval seed-demo smoke-cloud deploy

SCENARIO ?= drift
GROUP ?=
API_URL ?= http://127.0.0.1:8080

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

# Type checks only. No formatter is enforced in this prototype.
lint:
	$(PYTHON) -m compileall -q api/src scripts
	cd web && npx tsc --noEmit -p .

# Focused checks by name, e.g. make check SCENARIO=drift, SCENARIO=safety, SCENARIO=retention.
check:
	$(PYTHON) -m pytest api/tests -q -k $(SCENARIO)

# Labeled extraction cases against real Gemini Flash (about 30 calls). Writes eval/report.json.
eval:
	$(PYTHON) scripts/eval_extraction.py $(if $(GROUP),--group $(GROUP),)

seed-demo:
	$(PYTHON) scripts/seed_demo.py --api $(API_URL) --scenario $(SCENARIO)

smoke-cloud:
	$(PYTHON) scripts/smoke_cloud.py --invoke

deploy:
	powershell -File deployment/scripts/deploy.ps1
