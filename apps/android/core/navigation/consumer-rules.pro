# Navigation 3 saves the back stack with NavKeySerializer, which writes the concrete key's class name and restores it
# with Class.forName(...). Keep the names of the @Serializable destination keys stable under R8 so a back stack saved
# before process death can be restored (kotlinx.serialization ships its own rules for the generated serializers).
-keepnames class * implements androidx.navigation3.runtime.NavKey
