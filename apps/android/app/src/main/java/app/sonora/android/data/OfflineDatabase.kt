package app.sonora.android.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "offline_tracks")
data class OfflineTrack(
    @PrimaryKey val id: String,
    val title: String,
    val artist: String,
    val artworkUrl: String?,
    val localPath: String,
    val durationSeconds: Int,
    val provider: String,
    val savedAt: Long = System.currentTimeMillis()
)

@Dao
interface OfflineTrackDao {
    @Query("SELECT * FROM offline_tracks ORDER BY savedAt DESC")
    fun observeAll(): Flow<List<OfflineTrack>>
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(track: OfflineTrack)
    @Query("DELETE FROM offline_tracks WHERE id = :id")
    suspend fun delete(id: String)
}

@Database(entities = [OfflineTrack::class], version = 1, exportSchema = false)
abstract class OfflineDatabase : RoomDatabase() {
    abstract fun offlineTracks(): OfflineTrackDao
    companion object {
        @Volatile private var instance: OfflineDatabase? = null
        fun get(context: Context): OfflineDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, OfflineDatabase::class.java, "sonora-offline.db").build().also { instance = it }
        }
    }
}
