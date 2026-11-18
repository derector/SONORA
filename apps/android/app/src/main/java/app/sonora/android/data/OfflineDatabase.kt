package app.sonora.android.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "offline_tracks", primaryKeys = ["provider", "id"])
data class OfflineTrack(
    val id: String,
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

    @Query("DELETE FROM offline_tracks WHERE provider = :provider AND id = :id")
    suspend fun delete(provider: String, id: String)
}

@Database(entities = [OfflineTrack::class], version = 2, exportSchema = false)
abstract class OfflineDatabase : RoomDatabase() {
    abstract fun offlineTracks(): OfflineTrackDao

    companion object {
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS offline_tracks_new (id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, artworkUrl TEXT, localPath TEXT NOT NULL, durationSeconds INTEGER NOT NULL, provider TEXT NOT NULL, savedAt INTEGER NOT NULL, PRIMARY KEY(provider, id))"
                )
                database.execSQL(
                    "INSERT OR REPLACE INTO offline_tracks_new (id, title, artist, artworkUrl, localPath, durationSeconds, provider, savedAt) SELECT id, title, artist, artworkUrl, localPath, durationSeconds, provider, savedAt FROM offline_tracks"
                )
                database.execSQL("DROP TABLE offline_tracks")
                database.execSQL("ALTER TABLE offline_tracks_new RENAME TO offline_tracks")
            }
        }

        @Volatile
        private var instance: OfflineDatabase? = null

        fun get(context: Context): OfflineDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                OfflineDatabase::class.java,
                "sonora-offline.db"
            ).addMigrations(MIGRATION_1_2).build().also { instance = it }
        }
    }
}
