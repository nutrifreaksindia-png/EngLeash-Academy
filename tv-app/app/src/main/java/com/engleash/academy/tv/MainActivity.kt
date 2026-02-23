package com.engleash.academy.tv

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Api.token != null) {
            showMain()
        } else {
            setContentView(R.layout.activity_main)
            supportFragmentManager.beginTransaction()
                .replace(R.id.container, LoginFragment())
                .commit()
        }
    }

    fun onLoginSuccess() {
        showMain()
    }

    private fun showMain() {
        setContentView(R.layout.activity_main)
        supportFragmentManager.beginTransaction()
            .replace(R.id.container, CourseListFragment())
            .commit()
    }

    fun showLessons(courseId: Int, courseName: String) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.container, LessonListFragment.newInstance(courseId, courseName))
            .addToBackStack(null)
            .commit()
    }

    fun playVideo(lessonId: Int, title: String, videoUrl: String) {
        if (videoUrl.isBlank()) {
            Toast.makeText(this, "No video for this lesson", Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_TITLE, title)
            putExtra(PlayerActivity.EXTRA_VIDEO_URL, videoUrl)
        })
    }

    fun logout() {
        Api.clearToken(this)
        supportFragmentManager.beginTransaction()
            .replace(R.id.container, LoginFragment())
            .commitAllowingStateLoss()
    }
}
