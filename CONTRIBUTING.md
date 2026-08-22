# Contributing to Equxi

Thanks for your interest in contributing to Equxi.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Create a branch: `git checkout -b feature/your-feature`
4. Make your changes
5. Commit: `git commit -m "feat: your feature"`
6. Push: `git push origin feature/your-feature`
7. Open a Pull Request

## Development Setup

### Frontend

```bash
# No build step needed. Open index.html in browser.
# For local development with hot reload:
npx serve .
```

### Solana Program

```bash
# Install dependencies
curl --proto '=https' --tlsv1.2 -sSf https://release.anza.xyz/stable/install | sh
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1
avm use 0.30.1

# Build
anchor build

# Test
anchor test
```

### SDK

```bash
cd sdk
npm install
npm run build
```

## Guidelines

- **Code style:** Follow existing patterns. No linter configured yet.
- **Commits:** Use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
- **PRs:** Keep them focused. One feature or fix per PR.
- **Tests:** Add tests for new instructions if possible.
- **Security:** Never commit private keys, seed phrases, or API keys.

## Reporting Issues

- Use GitHub Issues for bugs and feature requests
- For security vulnerabilities, see [SECURITY.md](SECURITY.md)

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
