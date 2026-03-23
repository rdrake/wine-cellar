E2E_API_KEY := wc-e2etest0000000000000000000000000000000000000000000000000000000000

.PHONY: docs docs-serve docs-deploy reset-e2e test-e2e test-api test-dashboard test demo

docs:
	uvx --with mkdocs-material==9.6.14 mkdocs build --strict --clean

docs-serve:
	uvx --with mkdocs-material==9.6.14 mkdocs serve -a 0.0.0.0:8000

docs-deploy: docs
	npx wrangler pages deploy site --project-name wine-cellar-docs --commit-dirty=true

## Testing

test-api:
	cd api && npm test

test-dashboard:
	cd dashboard && npm test

reset-e2e:
	bash api/scripts/reset-e2e-db.sh

test-e2e:
	cd dashboard && E2E_API_KEY=$(E2E_API_KEY) npx playwright test

test: test-api test-dashboard test-e2e

## Demo

demo:
	bash scripts/demo.sh
