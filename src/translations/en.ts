// AuthNex Widget — Default English translations

export interface WidgetTranslations {
  signIn: string;
  signUp: string;
  signInSubtitle: string;
  signUpSubtitle: string;
  forgotPassword: string;
  forgotPasswordSubtitle: string;
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  confirmPasswordLabel: string;
  confirmPasswordPlaceholder: string;
  rememberMe: string;
  signInButton: string;
  signUpButton: string;
  sendResetLink: string;
  sendLoginLink: string;
  noAccount: string;
  hasAccount: string;
  backToSignIn: string;
  orContinueWith: string;
  accountCreated: string;
  resetLinkSent: string;
  magicLinkSent: string;
  passwordsNoMatch: string;
  offline: string;
  connectionError: string;
  tooManyAttempts: string;
  invalidCredentials: string;
  accountLocked: string;
  emailNotVerified: string;
  configError: string;
  emailExists: string;
  unknownError: string;
  securedBy: string;
  magicLinkLabel: string;
  magicLinkPlaceholder: string;
  // Passwordless
  enterEmail: string;
  checkEmailForLink: string;
}

export const EN: WidgetTranslations = {
  signIn: 'Sign In',
  signUp: 'Create Account',
  signInSubtitle: 'Enter your credentials to continue',
  signUpSubtitle: 'Sign up to get started',
  forgotPassword: 'Reset Password',
  forgotPasswordSubtitle: 'Enter your email to receive a reset link',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  passwordLabel: 'Password',
  passwordPlaceholder: 'Enter your password',
  confirmPasswordLabel: 'Confirm Password',
  confirmPasswordPlaceholder: 'Re-enter your password',
  rememberMe: 'Remember me',
  signInButton: 'Sign In',
  signUpButton: 'Create Account',
  sendResetLink: 'Send Reset Link',
  sendLoginLink: 'Send Login Link',
  noAccount: "Don't have an account?",
  hasAccount: 'Already have an account?',
  backToSignIn: 'Back to sign in',
  orContinueWith: 'or',
  accountCreated: 'Account created! Check your email to verify.',
  resetLinkSent: 'If the email exists, a reset link was sent.',
  magicLinkSent: 'Check your email for a login link.',
  passwordsNoMatch: 'Passwords do not match',
  offline: 'You appear to be offline',
  connectionError: 'Connection error. Check your internet',
  tooManyAttempts: 'Too many attempts. Try again in {seconds}s',
  invalidCredentials: 'Invalid email or password',
  accountLocked: 'Account locked. Please try again later',
  emailNotVerified: 'Please verify your email first',
  configError: 'Configuration error',
  emailExists: 'Account already exists. Try signing in',
  unknownError: 'Something went wrong. Please try again',
  securedBy: 'Secured by AuthNex',
  magicLinkLabel: 'Email',
  magicLinkPlaceholder: 'you@example.com',
  enterEmail: 'Enter your email to sign in',
  checkEmailForLink: 'Check your email for a login link',
};
