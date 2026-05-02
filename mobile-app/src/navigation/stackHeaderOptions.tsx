import React from 'react';
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { HeaderBackButton } from '@react-navigation/elements';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';

const BRAND_BLUE = '#1a237e';

function onNotificationsPress() {
  Alert.alert('Notifications', 'You have no new notifications yet.');
}

function HeaderBrandTitle() {
  return (
    <View style={styles.titleBlock} accessibilityRole="header">
      <Text style={styles.brandLine} numberOfLines={1}>
        EngLeash Academy
      </Text>
    </View>
  );
}

export function appStackScreenOptions(): NativeStackNavigationOptions {
  return {
    headerStyle: {
      backgroundColor: BRAND_BLUE,
      paddingVertical: 6,
    },
    headerTintColor: '#fff',
    headerTitleAlign: 'left',
    headerLeft: (props) => (
      <View style={[styles.leftRow, !props.canGoBack && styles.leftRowRoot]}>
        {props.canGoBack ? (
          <HeaderBackButton {...props} tintColor="#fff" label="" labelVisible={false} />
        ) : null}
        <View style={[styles.logoWrap, props.canGoBack ? styles.logoAfterBack : null]} accessibilityLabel="EngLeash Academy logo">
          <Image
            source={require('../../../brand/logo_icon.png')}
            style={styles.logo}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        </View>
      </View>
    ),
    headerRight: () => (
      <TouchableOpacity
        onPress={onNotificationsPress}
        style={styles.notifyBtn}
        accessibilityRole="button"
        accessibilityLabel="Notifications"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="notifications-outline" size={24} color="#fff" />
      </TouchableOpacity>
    ),
    headerTitle: () => <HeaderBrandTitle />,
  };
}

const styles = StyleSheet.create({
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftRowRoot: {
    marginLeft: 12,
  },
  logoWrap: {
    justifyContent: 'center',
    marginRight: 16,
  },
  logoAfterBack: {
    marginLeft: 10,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  notifyBtn: {
    marginRight: 14,
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleBlock: {
    justifyContent: 'center',
    maxWidth: '88%',
  },
  brandLine: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
