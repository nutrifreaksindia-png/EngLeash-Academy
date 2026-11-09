import React, { useLayoutEffect, useMemo } from 'react';
import { Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { appStackScreenOptions } from './stackHeaderOptions';

const HIDDEN_TAB_BAR_STYLE = {
  display: 'none' as const,
  height: 0,
  overflow: 'hidden' as const,
  opacity: 0,
  borderTopWidth: 0,
  elevation: 0,
  position: 'absolute' as const,
};

import LandingHomeScreen from '../screens/LandingHomeScreen';
import PublicCourseDetailScreen from '../screens/PublicCourseDetailScreen';
import ApplyCourseBatchesScreen from '../screens/ApplyCourseBatchesScreen';
import ApplyCallbackScreen from '../screens/ApplyCallbackScreen';
import CoursePurchaseSummaryScreen from '../screens/CoursePurchaseSummaryScreen';
import CourseSubscribePackagesScreen from '../screens/CourseSubscribePackagesScreen';
import MyCoursesScreen from '../screens/MyCoursesScreen';
import CourseCatalogScreen from '../screens/CourseCatalogScreen';
import CourseDetailScreen from '../screens/CourseDetailScreen';
import LessonDetailScreen from '../screens/LessonDetailScreen';
import VideoPlayerScreen from '../screens/VideoPlayerScreen';
import ClassNotesScreen from '../screens/ClassNotesScreen';
import QuizScreen from '../screens/QuizScreen';
import WorksheetScreen from '../screens/WorksheetScreen';
import WorksheetLibraryScreen from '../screens/WorksheetLibraryScreen';
import StudyMaterialScreen from '../screens/StudyMaterialScreen';
import AssignmentLibraryDetailScreen from '../screens/AssignmentLibraryDetailScreen';
import LearnModeScreen from '../screens/LearnModeScreen';
import AdminCourseManagerScreen from '../screens/AdminCourseManagerScreen';
import LiveSessionsScreen from '../screens/LiveSessionsScreen';
import LiveClassroomScreen from '../screens/LiveClassroomScreen';
import LiveScheduleScreen from '../screens/LiveScheduleScreen';
import SessionRecordingsScreen from '../screens/SessionRecordingsScreen';
import MyAssignmentsScreen from '../screens/MyAssignmentsScreen';
import AssignmentScreen from '../screens/AssignmentScreen';
import AssignmentOccurrenceScreen from '../screens/AssignmentOccurrenceScreen';
import AccountScreen from '../screens/AccountScreen';
import PaymentsInvoicesScreen from '../screens/PaymentsInvoicesScreen';
import SignupScreen from '../screens/SignupScreen';
import LoginScreen from '../screens/LoginScreen';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const CoursesStack = createNativeStackNavigator();
const SessionsStack = createNativeStackNavigator();
const AssignmentsStack = createNativeStackNavigator();
const AccountStack = createNativeStackNavigator();

const stackOpts = appStackScreenOptions();

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={stackOpts}>
      <HomeStack.Screen name="LandingHome" component={LandingHomeScreen} options={{ title: 'Home' }} />
      <HomeStack.Screen
        name="PublicCourseDetail"
        component={PublicCourseDetailScreen}
        options={({ route }: { route: { params?: { courseName?: string } } }) => ({
          title: route.params?.courseName || 'Course',
        })}
      />
      <HomeStack.Screen
        name="ApplyCourseBatches"
        component={ApplyCourseBatchesScreen}
        options={({ route }: { route: { params?: { course?: { name?: string } } } }) => ({
          title: route.params?.course?.name ? `Apply — ${route.params.course.name}` : 'Apply',
        })}
      />
      <HomeStack.Screen name="ApplyCallback" component={ApplyCallbackScreen} options={{ title: '' }} />
      <HomeStack.Screen name="CoursePurchaseSummary" component={CoursePurchaseSummaryScreen} options={{ title: 'Purchase' }} />
      <HomeStack.Screen
        name="CourseSubscribePackages"
        component={CourseSubscribePackagesScreen}
        options={({ route }: { route: { params?: { courseName?: string } } }) => ({
          title: route.params?.courseName || 'Plans',
        })}
      />
      <HomeStack.Screen
        name="Signup"
        component={SignupScreen}
        options={({ route }: { route: { params?: { redirectAfterSignup?: string } } }) => ({
          title: route.params?.redirectAfterSignup === 'apply' ? 'Sign up to apply' : 'Sign up',
        })}
      />
      <HomeStack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
    </HomeStack.Navigator>
  );
}

function CoursesStackNavigator({ navigation, route }: { navigation: any; route: any }) {
  const insets = useSafeAreaInsets();
  const visibleTabBarStyle = useMemo(
    () => ({
      paddingTop: 4,
      paddingBottom: Math.max(insets.bottom, 8),
      height: 58 + Math.max(insets.bottom, 8),
    }),
    [insets.bottom],
  );

  // Hide from the stack parent so Android doesn't leave a white tab-bar gap under LearnMode
  // (fullScreenModal alone is not enough on Android).
  useLayoutEffect(() => {
    const focused = getFocusedRouteNameFromRoute(route) ?? 'MyCoursesList';
    navigation.setOptions({
      tabBarStyle: focused === 'LearnMode' ? HIDDEN_TAB_BAR_STYLE : visibleTabBarStyle,
    });
  }, [navigation, route, visibleTabBarStyle]);

  return (
    <CoursesStack.Navigator screenOptions={stackOpts} initialRouteName="MyCoursesList">
      <CoursesStack.Screen name="MyCoursesList" component={MyCoursesScreen} options={{ title: '', headerShown: false }} />
      <CoursesStack.Screen name="CourseCatalog" component={CourseCatalogScreen} options={{ title: 'Course catalog' }} />
      <CoursesStack.Screen
        name="CourseDetail"
        component={CourseDetailScreen}
        options={({ route }: { route: { params?: { courseName?: string } } }) => ({ title: route.params?.courseName || 'Course' })}
      />
      <CoursesStack.Screen
        name="LessonDetail"
        component={LessonDetailScreen}
        options={({ route }: { route: { params?: { lessonTitle?: string } } }) => ({ title: route.params?.lessonTitle || 'Lesson' })}
      />
      <CoursesStack.Screen
        name="LearnMode"
        component={LearnModeScreen}
        options={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#e8eef9' },
        }}
      />
      <CoursesStack.Screen name="VideoPlayer" component={VideoPlayerScreen} options={{ title: 'Video', headerShown: false }} />
      <CoursesStack.Screen name="ClassNotes" component={ClassNotesScreen} options={{ title: 'Class notes' }} />
      <CoursesStack.Screen name="Quiz" component={QuizScreen} options={{ title: 'Quiz' }} />
      <CoursesStack.Screen name="Worksheet" component={WorksheetScreen} options={{ title: 'Worksheet (PDF)' }} />
      <CoursesStack.Screen name="WorksheetLibrary" component={WorksheetLibraryScreen} options={{ title: 'Worksheet' }} />
      <CoursesStack.Screen name="StudyMaterial" component={StudyMaterialScreen} options={{ title: 'Study Material' }} />
      <CoursesStack.Screen
        name="AssignmentLibraryDetail"
        component={AssignmentLibraryDetailScreen}
        options={{ title: 'Assignment' }}
      />
      <CoursesStack.Screen name="AdminCourseManager" component={AdminCourseManagerScreen} options={{ title: 'Manage courses' }} />
    </CoursesStack.Navigator>
  );
}

function SessionsStackNavigator() {
  return (
    <SessionsStack.Navigator screenOptions={stackOpts} initialRouteName="LiveSessions">
      <SessionsStack.Screen name="LiveSessions" component={LiveSessionsScreen} options={{ title: 'My Sessions' }} />
      <SessionsStack.Screen name="LiveClassroom" component={LiveClassroomScreen} options={{ title: 'Live classroom' }} />
      <SessionsStack.Screen
        name="SessionRecordingPlayer"
        component={VideoPlayerScreen}
        options={{ title: 'Recording', headerShown: false }}
      />
      <SessionsStack.Screen
        name="SessionRecordings"
        component={SessionRecordingsScreen}
        options={{ title: 'Recordings' }}
      />
      <SessionsStack.Screen name="LiveSchedule" component={LiveScheduleScreen} options={{ title: 'Schedule live' }} />
    </SessionsStack.Navigator>
  );
}

function AssignmentsStackNavigator() {
  return (
    <AssignmentsStack.Navigator screenOptions={stackOpts} initialRouteName="MyAssignmentsHome">
      <AssignmentsStack.Screen name="MyAssignmentsHome" component={MyAssignmentsScreen} options={{ title: 'My Assignments' }} />
      <AssignmentsStack.Screen name="Assignment" component={AssignmentScreen} options={{ title: 'Assignment' }} />
      <AssignmentsStack.Screen
        name="AssignmentOccurrence"
        component={AssignmentOccurrenceScreen}
        options={{ title: 'Assignment' }}
      />
    </AssignmentsStack.Navigator>
  );
}

function AccountStackNavigator() {
  return (
    <AccountStack.Navigator screenOptions={stackOpts}>
      <AccountStack.Screen name="AccountMain" component={AccountScreen} options={{ title: 'My Account' }} />
      <AccountStack.Screen name="PaymentsInvoices" component={PaymentsInvoicesScreen} options={{ title: 'Payments & Invoices' }} />
      <AccountStack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
      <AccountStack.Screen name="Signup" component={SignupScreen} options={{ title: 'Sign up' }} />
    </AccountStack.Navigator>
  );
}

function tabBarIcon(filled: keyof typeof Ionicons.glyphMap, outline: keyof typeof Ionicons.glyphMap) {
  return ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Ionicons name={focused ? filled : outline} size={size ?? 24} color={color} />
  );
}

function lockedTabButton(enabled: boolean) {
  return ({ href: _href, ...props }: { href?: string; style?: object; onPress?: (...args: any[]) => void; [key: string]: any }) => (
    <Pressable
      {...props}
      disabled={!enabled}
      onPress={enabled ? props.onPress : undefined}
      accessibilityState={{ ...(props.accessibilityState || {}), disabled: !enabled }}
      style={[props.style, !enabled ? { opacity: 0.38 } : null]}
    />
  );
}

export default function MainTabNavigator() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const signedIn = Boolean(user);
  const lockedTint = '#b0b4bc';

  return (
    <Tab.Navigator
      sceneContainerStyle={{ backgroundColor: '#e8eef9' }}
      screenOptions={{
        headerShown: false,
        popToTopOnBlur: true,
        tabBarActiveTintColor: '#c41e3a',
        tabBarInactiveTintColor: '#666',
        tabBarStyle: {
          paddingTop: 4,
          paddingBottom: Math.max(insets.bottom, 8),
          height: 58 + Math.max(insets.bottom, 8),
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStackNavigator}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: tabBarIcon('home', 'home-outline'),
        }}
      />
      <Tab.Screen
        name="MyCourses"
        component={CoursesStackNavigator}
        options={({ route }) => {
          const focused = getFocusedRouteNameFromRoute(route) ?? 'MyCoursesList';
          const immersive = focused === 'LearnMode';
          return {
            tabBarLabel: 'My Courses',
            tabBarIcon: tabBarIcon('school', 'school-outline'),
            tabBarActiveTintColor: signedIn ? '#c41e3a' : lockedTint,
            tabBarInactiveTintColor: signedIn ? '#666' : lockedTint,
            tabBarButton: lockedTabButton(signedIn),
            tabBarStyle: immersive ? HIDDEN_TAB_BAR_STYLE : {
              paddingTop: 4,
              paddingBottom: Math.max(insets.bottom, 8),
              height: 58 + Math.max(insets.bottom, 8),
            },
          };
        }}
        listeners={{
          tabPress: (e) => {
            if (!signedIn) e.preventDefault();
          },
        }}
      />
      <Tab.Screen
        name="MySessions"
        component={SessionsStackNavigator}
        options={{
          tabBarLabel: 'My Sessions',
          tabBarIcon: tabBarIcon('videocam', 'videocam-outline'),
          tabBarActiveTintColor: signedIn ? '#c41e3a' : lockedTint,
          tabBarInactiveTintColor: signedIn ? '#666' : lockedTint,
          tabBarButton: lockedTabButton(signedIn),
        }}
        listeners={{
          tabPress: (e) => {
            if (!signedIn) e.preventDefault();
          },
        }}
      />
      <Tab.Screen
        name="MyAssignments"
        component={AssignmentsStackNavigator}
        options={{
          tabBarLabel: 'My Assignments',
          tabBarIcon: tabBarIcon('clipboard', 'clipboard-outline'),
          tabBarActiveTintColor: signedIn ? '#c41e3a' : lockedTint,
          tabBarInactiveTintColor: signedIn ? '#666' : lockedTint,
          tabBarButton: lockedTabButton(signedIn),
        }}
        listeners={{
          tabPress: (e) => {
            if (!signedIn) e.preventDefault();
          },
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountStackNavigator}
        options={{
          tabBarLabel: 'My Account',
          tabBarIcon: tabBarIcon('person', 'person-outline'),
        }}
      />
    </Tab.Navigator>
  );
}
