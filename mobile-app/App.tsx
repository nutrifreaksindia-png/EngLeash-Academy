/**
 * EngLeash Academy – Mobile App
 * @format
 */

import React, { useEffect } from 'react';
import { ActivityIndicator, Image, StatusBar, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import MainTabNavigator from './src/navigation/MainTabs';
import { lockAppPortrait } from './src/utils/appScreenOrientation';

function RootNavigator() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a237e' }}>
        <Image
          source={require('../brand/logo_icon.png')}
          style={{ width: 72, height: 72, borderRadius: 36, marginBottom: 20 }}
          resizeMode="cover"
          accessibilityLabel="EngLeash Academy"
        />
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return <MainTabNavigator />;
}

export default function App() {
  useEffect(() => {
    void lockAppPortrait();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1a237e" />
      <AuthProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
