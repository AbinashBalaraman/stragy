# Contributing to Stragy

Thank you for your interest in contributing to **Stragy**!

## How to Contribute

1. **Fork the Repository**: Click "Fork" on GitHub.
2. **Clone your Fork**:
   ```bash
   git clone https://github.com/YOUR-USERNAME/stragy.git
   cd stragy
   ```
3. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/my-new-feature
   ```
4. **Make Changes & Test**:
   - Ensure `npm run lint` passes with zero errors.
   - Run `npm run build` to verify production builds.
5. **Commit your Changes**:
   ```bash
   git commit -m "feat: add support for Stochastic Oscillator indicator"
   ```
6. **Push & Open a Pull Request**:
   ```bash
   git push origin feature/my-new-feature
   ```

## Code Standards
- **TypeScript**: Strict types across all engine and UI modules.
- **Styling**: Tailwind CSS utility classes.
- **Component Design**: Modular, decoupled components with shared types in `src/shared/strategy/types.ts`.
