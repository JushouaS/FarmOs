# Kinect bridge

Streams a Kinect v2 depth camera to the web app over a WebSocket, so **Live Camera** can show it as
a live 3D point cloud. The full steps are in `HOW_TO_RUN.md` (section 7).

```
Kinect v2 --USB 3--> KinectBridge.exe --ws://localhost:8181--> Live Camera page
```

- Needs the Kinect for Windows SDK 2.0 and a USB 3.0 port.
- `build.cmd` compiles `Program.cs` with the C# compiler that ships with Windows. No Visual Studio or NuGet needed.
- Depth is cut to 256x212 and sent at about 15 frames per second as binary messages (see the comment at the top of `Program.cs` for the layout), which is far lighter than JSON.
- Only pages from this PC or the local network may connect.
- `KinectBridge.exe --lan` listens for other devices. Windows requires an administrator window, or
  `netsh http add urlacl url=http://+:8181/ user=Everyone` once.
- The viewer is `src/components/farm/KinectDepthView.tsx`.
