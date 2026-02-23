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

class CourseListFragment : Fragment() {
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        return inflater.inflate(R.layout.fragment_list, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        view.findViewById<TextView>(R.id.title).text = "Courses"
        view.findViewById<TextView>(R.id.back).apply {
            text = "Log out"
            setOnClickListener { (activity as? MainActivity)?.logout() }
        }
        val list = view.findViewById<ListView>(R.id.list)
        viewLifecycleOwner.lifecycleScope.launch {
            Api.getCourses().fold(
                onSuccess = { courses ->
                    list.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_list_item_1, courses.map { it.name })
                    list.onItemClickListener = AdapterView.OnItemClickListener { _, _, position, _ ->
                        val c = courses[position]
                        (activity as? MainActivity)?.showLessons(c.id, c.name)
                    }
                },
                onFailure = { Toast.makeText(requireContext(), it.message ?: "Failed to load", Toast.LENGTH_SHORT).show() }
            )
        }
    }
}
