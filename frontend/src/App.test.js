import React from 'react';
import { render } from '@testing-library/react';

jest.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }) => <>{children}</>,
  Routes: ({ children }) => <>{children}</>,
  Route: ({ element }) => element || null,
  Navigate: () => null,
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/' }),
  useSearchParams: () => [new URLSearchParams(), jest.fn()]
}), { virtual: true });

import App from './App';

test('renders app without crashing', () => {
  expect(() => render(<App />)).not.toThrow();
});
