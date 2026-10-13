import React, { useEffect, useState } from 'react'
import { Card, Button, Input, Spinner } from '../../components/common'
import { studentAPI } from '../../services/api'
import { useAuth } from '../../store'
import type { Student } from '../../types'

export const ProfilePage: React.FC = () => {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Student | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await studentAPI.getProfile()
        setProfile(res.data.data)
      } catch (err) {
        console.error('Failed to load profile', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!profile) return
    setProfile({ ...profile, [e.target.name]: e.target.value })
    setSuccess(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return
    setSaving(true)
    try {
      await studentAPI.updateProfile({ name: profile.name })
      setSuccess(true)
    } catch (err) {
      console.error('Failed to update profile', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="text-indigo-600" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-gray-500 mt-1">Manage your account information</p>
      </div>

      <Card>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xl font-semibold">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{user?.name}</h2>
            <p className="text-sm text-gray-500">{user?.matricNumber}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="Full Name"
            name="name"
            value={profile.name}
            onChange={handleChange}
            required
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Matriculation Number
            </label>
            <input
              value={profile.matricNumber}
              disabled
              className="w-full px-3 py-2 border border-gray-200 rounded-lg shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-gray-400">
              Managed by your administrator and cannot be changed.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Program</label>
            <input
              value={profile.program}
              disabled
              className="w-full px-3 py-2 border border-gray-200 rounded-lg shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Level</label>
            <input
              value={profile.level}
              disabled
              className="w-full px-3 py-2 border border-gray-200 rounded-lg shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          {success && (
            <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">
              Profile updated successfully
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}