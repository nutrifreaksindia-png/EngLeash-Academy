/**
 * @format
 */

import 'expo-dev-client';
import { registerGlobals } from '@livekit/react-native';
import { registerRootComponent } from 'expo';
import App from './App';

registerGlobals();

registerRootComponent(App);
