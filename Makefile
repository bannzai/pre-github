# `make` with no arguments runs the verification (verify)
.DEFAULT_GOAL := verify

.PHONY: verify
verify:
	npm run lint
	npm run format:check
	npm run typecheck
	npm test
	bash scripts/test/test-preview-scripts.sh
	npm run build
	npm run test:e2e
