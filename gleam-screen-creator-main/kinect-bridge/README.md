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
- If the Kinect drops out (a loose USB cable, power) and comes back without sending pictures again, the bridge
  notices after 5 seconds, prints `Nothing from the Kinect ... Opening it again.` and opens the sensor again. It
  waits longer between tries (up to a minute) while the Kinect stays gone.

## Picture or depth

A viewer gets depth frames unless it asks for the picture: it sends the text `{"want":"color"}` (and
`{"want":"depth"}` to go back). A picture frame is one binary message holding a JPEG of about 960x540, about
10 a second (it starts with the bytes `FF D8`, which a depth frame never does). Pictures are only made while a
viewer is asking for them. `build.cmd` needs `System.Drawing` for this, which Windows already has.
