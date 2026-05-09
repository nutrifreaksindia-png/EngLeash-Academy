import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { appStackScreenOptions } from './stackHeaderOptions';

import LandingHomeScreen from '../screens/LandingHomeScreen';
import PublicCourseDetailScreen from '../screens/PublicCourseDetailScreen';
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
import AdminCourseManagerScreen from '../screens/AdminCourseManagerScreen';
import LiveSessionsScreen from '../screens/LiveSessionsScreen';
import LiveClassroomScreen from '../screens/LiveClassroomScreen';
import LiveScheduleScreen from '../screens/LiveScheduleScreen';
import SessionRecordingsScreen from '../screens/SessionRecordingsScreen';
import MyAssignmentsScreen from '../screens/MyAssignmentsScreen';
import AssignmentScreen from '../screens/AssignmentScreen';
import AccountScreen from '../screens/AccountScreen';
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
    </HomeStack.Navigator>
  );
}

function CoursesStackNavigator() {
  return (
    <CoursesStack.Navigator screenOptions={stackOpts} initialRouteName="MyCoursesList">
      <CoursesStack.Screen name="MyCoursesList" component={MyCoursesScreen} options={{ title: 'My Courses' }} />
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
    </AssignmentsStack.Navigator>
  );
}

function AccountStackNavigator() {
  return (
    <AccountStack.Navigator screenOptions={stackOpts}>
      <AccountStack.Screen name="AccountMain" component={AccountScreen} options={{ title: 'My Account' }} />
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

export default function MainTabNavigator() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
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
        options={{
          tabBarLabel: 'My Courses',
          tabBarIcon: tabBarIcon('school', 'school-outline'),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (!user) {
              e.preventDefault();
              navigation.navigate('Account');
            }
          },
        })}
      />
      <Tab.Screen
        name="MySessions"
        component={SessionsStackNavigator}
        options={{
          tabBarLabel: 'My Sessions',
          tabBarIcon: tabBarIcon('videocam', 'videocam-outline'),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (!user) {
              e.preventDefault();
              navigation.navigate('Account');
            }
          },
        })}
      />
      <Tab.Screen
        name="MyAssignments"
        component={AssignmentsStackNavigator}
        options={{
          tabBarLabel: 'My Assignments',
          tabBarIcon: tabBarIcon('clipboard', 'clipboard-outline'),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (!user) {
              e.preventDefault();
              navigation.navigate('Account');
            }
          },
        })}
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
