import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type Props = {
  /** Called after successful login (user is in context). */
  onLoggedIn?: () => void;
  navigation?: { navigate: (name: string, params?: Record<string, unknown>) => void };
  showSignupLink?: boolean;
  /** Forward apply/purchase resume params when opening Signup from this form. */
  signupRouteParams?: Record<string, unknown>;
};

export default function LoginForm({ onLoggedIn, navigation, showSignupLink = true, signupRouteParams }: Props) {
  const { login, replaceSessionAndLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      onLoggedIn?.();
    } catch (e: any) {
      if (e?.message === 'ALREADY_LOGGED_IN' && e?.deviceName) {
        const deviceName = e.deviceName as string;
        Alert.alert(
          'Already logged in',
          `Already logged in on another device: ${deviceName}. Do you want to log out from ${deviceName} and sign in here?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Yes, sign in here',
              onPress: async () => {
                setLoading(true);
                try {
                  await replaceSessionAndLogin(email.trim(), password);
                  onLoggedIn?.();
                } catch (err: any) {
                  Alert.alert('Error', err?.message || 'Failed to sign in');
                } finally {
                  setLoading(false);
                }
              },
            },
          ]
        );
      } else {
        Alert.alert('Login failed', e?.message || 'Invalid credentials');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <Image
        source={require('../../../brand/logo_long.jpg')}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="EngLeash Academy"
      />
      <Text style={styles.subtitle}>Unleash your English from here</Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="your@email.com"
        placeholderTextColor="#999"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        placeholderTextColor="#999"
        secureTextEntry
      />

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
      </TouchableOpacity>
      {showSignupLink && navigation ? (
        <TouchableOpacity
          style={styles.signUpLink}
          onPress={() =>
            signupRouteParams && Object.keys(signupRouteParams).length > 0
              ? navigation.navigate('Signup', signupRouteParams)
              : navigation.navigate('Signup')
          }
        >
          <Text style={styles.signUpText}>New student? Sign up</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
  },
  logo: {
    width: '100%',
    maxWidth: 280,
    height: 72,
    alignSelf: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: BRAND_BLUE,
    textAlign: 'center',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: BRAND_RED,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  signUpLink: {
    marginTop: 14,
    alignItems: 'center',
  },
  signUpText: {
    color: BRAND_BLUE,
    fontWeight: '700',
  },
});
