.PHONY: docs docs-serve docs-deploy

docs:
	uvx --with mkdocs-material==9.6.14 mkdocs build --strict --clean

docs-serve:
	uvx --with mkdocs-material==9.6.14 mkdocs serve -a 0.0.0.0:8000

docs-deploy: docs
	npx wrangler pages deploy site --project-name wine-cellar-docs --commit-dirty=true
