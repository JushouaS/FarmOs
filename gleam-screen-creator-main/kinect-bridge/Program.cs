using System;
using System.Collections.Generic;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Kinect;

// Streams the Kinect v2 depth camera to the web app over a WebSocket.
//
// Browsers cannot reach the Kinect driver, so this small program reads the
// depth frames and sends them to ws://localhost:8181. The Live Camera page
// draws them as a 3D point cloud. Needs the Kinect for Windows SDK 2.0 and a
// USB 3.0 port. Written in C# 5 so the .NET Framework compiler that ships with
// Windows can build it (see build.cmd).
//
// Each frame is one binary message:
//   bytes 0-1  width   (uint16, little endian)
//   bytes 2-3  height  (uint16)
//   bytes 4-7  frame time in milliseconds (uint32)
//   then width * height uint16 depth values in millimeters, row by row.
//   0 means "no reading" (too close, too far, or a shadow).
// On connect the first message is a JSON "hello" with the size and the camera
// intrinsics, so the page does not hard-code them.
namespace CerebroilKinectBridge
{
    internal sealed class Client
    {
        public WebSocket Socket;
        public volatile bool Busy;
    }

    internal static class Program
    {
        const int Port = 8181;
        const int Step = 2;              // keep every 2nd pixel: 512x424 becomes 256x212
        const int FrameGapMs = 66;       // about 15 frames per second
        const int MinMm = 500;           // the v2 sensor is only reliable from 0.5 m ...
        const int MaxMm = 4500;          // ... to 4.5 m

        static readonly object Lock = new object();
        static readonly List<Client> Clients = new List<Client>();
        static ushort[] _raw;
        static ushort[] _small;
        static int _outW, _outH;
        static long _lastSentTicks;
        static int _framesSent;

        static void Main(string[] args)
        {
            bool lan = Array.IndexOf(args, "--lan") >= 0;

            KinectSensor sensor = KinectSensor.GetDefault();
            if (sensor == null)
            {
                Console.WriteLine("No Kinect found. Install the Kinect for Windows SDK 2.0 and plug the sensor into a USB 3.0 port.");
                return;
            }

            FrameDescription fd = sensor.DepthFrameSource.FrameDescription;
            _outW = fd.Width / Step;
            _outH = fd.Height / Step;
            _raw = new ushort[fd.Width * fd.Height];
            _small = new ushort[_outW * _outH];

            sensor.IsAvailableChanged += delegate(object s, IsAvailableChangedEventArgs e)
            {
                Console.WriteLine(e.IsAvailable ? "Kinect is sending data." : "Kinect is not available (unplugged, no power, or not on USB 3.0).");
            };
            DepthFrameReader reader = sensor.DepthFrameSource.OpenReader();
            reader.FrameArrived += OnFrame;
            sensor.Open();

            HttpListener listener = new HttpListener();
            if (lan)
            {
                // Reachable from other devices. Windows only allows this for an
                // administrator or after: netsh http add urlacl url=http://+:8181/ user=Everyone
                listener.Prefixes.Add("http://+:" + Port + "/");
            }
            else
            {
                listener.Prefixes.Add("http://localhost:" + Port + "/");
                listener.Prefixes.Add("http://127.0.0.1:" + Port + "/");
            }
            try
            {
                listener.Start();
            }
            catch (HttpListenerException ex)
            {
                Console.WriteLine("Could not listen on port " + Port + ": " + ex.Message);
                return;
            }

            Console.WriteLine("Kinect bridge ready on ws://" + (lan ? "<this PC>" : "localhost") + ":" + Port + " (" + _outW + "x" + _outH + ", about 15 fps).");
            Console.WriteLine("Press Ctrl+C to stop.");

            ManualResetEvent stop = new ManualResetEvent(false);
            Console.CancelKeyPress += delegate(object s, ConsoleCancelEventArgs e) { e.Cancel = true; stop.Set(); };

            Task.Run(() => AcceptLoop(listener));
            stop.WaitOne();

            reader.Dispose();
            sensor.Close();
            listener.Close();
        }

        static async Task AcceptLoop(HttpListener listener)
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = await listener.GetContextAsync(); }
                catch (Exception) { return; }
                Task ignored = HandleRequest(ctx);
            }
        }

        static async Task HandleRequest(HttpListenerContext ctx)
        {
            try
            {
                if (!ctx.Request.IsWebSocketRequest)
                {
                    byte[] body = Encoding.UTF8.GetBytes("Cerebroil Kinect bridge. Connect with a WebSocket.");
                    ctx.Response.ContentType = "text/plain";
                    ctx.Response.OutputStream.Write(body, 0, body.Length);
                    ctx.Response.Close();
                    return;
                }
                // A web page from the open internet must not be able to read the camera.
                if (!IsAllowedOrigin(ctx.Request.Headers["Origin"]))
                {
                    ctx.Response.StatusCode = 403;
                    ctx.Response.Close();
                    return;
                }

                HttpListenerWebSocketContext wsCtx = await ctx.AcceptWebSocketAsync(null);
                Client client = new Client();
                client.Socket = wsCtx.WebSocket;

                string hello = "{\"type\":\"hello\",\"width\":" + _outW + ",\"height\":" + _outH +
                    ",\"fx\":" + (366.0 / Step).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) +
                    ",\"fy\":" + (366.0 / Step).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) +
                    ",\"cx\":" + (_outW / 2.0).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) +
                    ",\"cy\":" + (_outH / 2.0).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) +
                    ",\"minMm\":" + MinMm + ",\"maxMm\":" + MaxMm + "}";
                await client.Socket.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(hello)),
                    WebSocketMessageType.Text, true, CancellationToken.None);

                lock (Lock) { Clients.Add(client); }
                Console.WriteLine("Viewer connected (" + Clients.Count + " now).");

                // Nothing is expected from the page; reading just notices when it leaves.
                byte[] buf = new byte[256];
                while (client.Socket.State == WebSocketState.Open)
                {
                    WebSocketReceiveResult r = await client.Socket.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                }
                Remove(client);
            }
            catch (Exception)
            {
                try { ctx.Response.Abort(); } catch (Exception) { }
            }
        }

        static void Remove(Client client)
        {
            lock (Lock)
            {
                if (Clients.Remove(client)) Console.WriteLine("Viewer left (" + Clients.Count + " now).");
            }
            try { client.Socket.Abort(); } catch (Exception) { }
        }

        static void OnFrame(object sender, DepthFrameArrivedEventArgs e)
        {
            Client[] targets;
            lock (Lock) { targets = Clients.ToArray(); }
            if (targets.Length == 0) return;

            long now = DateTime.UtcNow.Ticks;
            if ((now - _lastSentTicks) / TimeSpan.TicksPerMillisecond < FrameGapMs) return;

            uint stamp;
            using (DepthFrame frame = e.FrameReference.AcquireFrame())
            {
                if (frame == null) return;
                frame.CopyFrameDataToArray(_raw);
                stamp = (uint)frame.RelativeTime.TotalMilliseconds;
            }
            _lastSentTicks = now;

            int srcW = _outW * Step;
            for (int y = 0; y < _outH; y++)
            {
                int srcRow = y * Step * srcW;
                int dstRow = y * _outW;
                for (int x = 0; x < _outW; x++)
                {
                    ushort d = _raw[srcRow + x * Step];
                    _small[dstRow + x] = (d < MinMm || d > MaxMm) ? (ushort)0 : d;
                }
            }

            byte[] msg = new byte[8 + _small.Length * 2];
            Buffer.BlockCopy(BitConverter.GetBytes((ushort)_outW), 0, msg, 0, 2);
            Buffer.BlockCopy(BitConverter.GetBytes((ushort)_outH), 0, msg, 2, 2);
            Buffer.BlockCopy(BitConverter.GetBytes(stamp), 0, msg, 4, 4);
            Buffer.BlockCopy(_small, 0, msg, 8, _small.Length * 2);

            foreach (Client c in targets)
            {
                // A slow viewer skips frames instead of piling them up.
                if (c.Busy || c.Socket.State != WebSocketState.Open) continue;
                c.Busy = true;
                Client captured = c;
                c.Socket.SendAsync(new ArraySegment<byte>(msg), WebSocketMessageType.Binary, true, CancellationToken.None)
                    .ContinueWith(delegate(Task t)
                    {
                        captured.Busy = false;
                        if (t.IsFaulted) Remove(captured);
                    });
            }

            _framesSent++;
            if (_framesSent % 150 == 0) Console.WriteLine("Sent " + _framesSent + " frames.");
        }

        // Pages served from this PC or from the local network are fine.
        static bool IsAllowedOrigin(string origin)
        {
            if (string.IsNullOrEmpty(origin)) return true;
            Uri uri;
            if (!Uri.TryCreate(origin, UriKind.Absolute, out uri)) return false;
            string host = uri.Host;
            if (host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]") return true;
            if (host.EndsWith(".local") || host.EndsWith(".localhost")) return true;
            IPAddress ip;
            if (!IPAddress.TryParse(host, out ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return false;
            byte[] b = ip.GetAddressBytes();
            return b[0] == 10 || (b[0] == 192 && b[1] == 168) || (b[0] == 172 && b[1] >= 16 && b[1] <= 31);
        }
    }
}
