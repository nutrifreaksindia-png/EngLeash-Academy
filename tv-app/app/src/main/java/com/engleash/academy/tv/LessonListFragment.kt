package com.engleash.academy.tv

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class LessonListFragment : Fragment() {
    private var courseId: Int = 0
    private var courseName: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        courseId = arguments?.getInt(ARG_COURSE_ID, 0) ?: 0
        courseName = arguments?.getString(ARG_COURSE_NAME, "") ?: ""
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        return inflater.inflate(R.layout.fragment_list, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        view.findViewById<TextView>(R.id.title).text = courseName
        view.findViewById<TextView>(R.id.back).apply {
            text = "Back"
            setOnClickListener { requireActivity().supportFragmentManager.popBackStack() }
        }
        val list = view.findViewById<ListView>(R.id.list)
        viewLifecycleOwner.lifecycleScope.launch {
            Api.getLessons(courseId).fold(
                onSuccess = { lessons ->
                    list.adapter = ArrayAdapter(requireContext(), R.layout.list_item, lessons.map { it.title })
                    list.onItemClickListener = AdapterView.OnItemClickListener { _, _, position, _ ->
                        val lesson = lessons[position]
                        viewLifecycleOwner.lifecycleScope.launch {
                            Api.getLesson(lesson.id).fold(
                                onSuccess = { detail ->
                                    (activity as? MainActivity)?.playVideo(detail.id, detail.title, detail.videoUrl)
                                },
                                onFailure = {
                                    if (it.message == "SESSION_REPLACED") (activity as? MainActivity)?.sessionReplaced()
                                    else Toast.makeText(requireContext(), it.message ?: "Failed", Toast.LENGTH_SHORT).show()
                                }
                            )
                        }
                    }
                },
                onFailure = {
                    if (it.message == "SESSION_REPLACED") (activity as? MainActivity)?.sessionReplaced()
                    else Toast.makeText(requireContext(), it.message ?: "Failed to load lessons", Toast.LENGTH_SHORT).show()
                }
            )
        }
    }

    companion object {
        private const val ARG_COURSE_ID = "courseId"
        private const val ARG_COURSE_NAME = "courseName"
        fun newInstance(courseId: Int, courseName: String) = LessonListFragment().apply {
            arguments = Bundle().apply {
                putInt(ARG_COURSE_ID, courseId)
                putString(ARG_COURSE_NAME, courseName)
            }
        }
    }
}
