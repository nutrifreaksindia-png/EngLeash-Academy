import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const BRAND_BLUE = '#1a237e';

type AuthIntent = 'apply' | 'purchase' | 'subscribe';

type Props = {
  intent: AuthIntent;
  courseName?: string;
};

function courseLabel(name?: string) {
  const n = String(name || '').trim();
  return n ? ` for “${n}”` : '';
}

const COPY: Record<AuthIntent, { title: string; body: (courseName?: string) => string }> = {
  apply: {
    title: 'Sign up to apply',
    body: (courseName) =>
      `Create your account${courseLabel(courseName)} — then choose a batch and complete your application.`,
  },
  purchase: {
    title: 'Sign up to purchase',
    body: (courseName) =>
      `Create your account${courseLabel(courseName)} — then review fees and pay securely.`,
  },
  subscribe: {
    title: 'Sign up to subscribe',
    body: (courseName) =>
      `Create your account${courseLabel(courseName)} — then pick a plan that fits you.`,
  },
};

export function authIntentFromRoute(params: Record<string, unknown> | undefined | null): AuthIntent | null {
  const r = String(params?.redirectAfterSignup || '');
  if (r === 'apply' || r === 'purchase' || r === 'subscribe') return r;
  return null;
}

export default function AuthIntentBanner({ intent, courseName }: Props) {
  const copy = COPY[intent];
  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body(courseName)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  title: { fontSize: 16, fontWeight: '700', color: BRAND_BLUE, marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 20, color: '#334155' },
});
