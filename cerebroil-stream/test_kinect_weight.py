import socket
import struct
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np

import kinect_seg
import kinect_weight


class KinectWeightTests(unittest.TestCase):
    def test_rgb_mask_features_measure_area_and_shape(self):
        mask = np.zeros((kinect_weight.DEPTH_H, kinect_weight.DEPTH_W), dtype=np.uint8)
        cv2.ellipse(mask, (256, 212), (60, 30), 0, 0, 360, 1, -1)

        features = kinect_weight.measure_rgb_mask(mask)

        self.assertIsNotNone(features)
        self.assertGreater(features["pixel_count"], 5_000)
        self.assertGreater(features["elongation"], 1.5)
        self.assertLess(features["elongation"], 2.5)

    def test_model_loads_and_predicts_from_its_two_features(self):
        model = kinect_weight.WeightModel(kinect_weight.LEGACY_MODEL_PATH)

        self.assertTrue(model.available, model.error)
        prediction = model.predict([{"pixel_count": 2260.0, "elongation": 1.53}])
        self.assertEqual(len(prediction), 1)
        self.assertGreater(prediction[0], 0)
        self.assertIsNone(model.typical_error_percent)

    def test_weight_estimate_does_not_require_a_depth_frame(self):
        bird = {
            "polygon": [
                [0.46, 0.4],
                [0.54, 0.4],
                [0.54, 0.6],
                [0.46, 0.6],
            ]
        }

        with patch.object(kinect_seg, "_weights", kinect_weight.WeightModel(kinect_weight.LEGACY_MODEL_PATH)):
            result = kinect_seg.add_weights([bird], 1280, 720, None)

        self.assertEqual(result["weightStatus"], "ok")
        self.assertIsNotNone(bird["weightG"])
        self.assertNotIn("errorPercent", result["weight"])

    def test_registered_mask_uses_depth_to_color_coordinates(self):
        color_mask = np.zeros((540, 960), dtype=np.uint8)
        color_mask[0, 0] = 1
        color_mask[539, 959] = 1
        coordinates = np.full((424, 512, 2), 65535, dtype=np.uint16)
        coordinates[0, 0] = [0, 0]
        coordinates[0, 1] = [1918, 1078]
        coordinates[0, 2] = [1919, 1079]

        registered = kinect_weight.register_color_mask_to_depth(
            color_mask, coordinates, color_mask.shape
        )

        self.assertEqual(int(registered[0, 0]), 1)
        self.assertEqual(int(registered[0, 1]), 1)
        self.assertEqual(int(registered[0, 2]), 0)
        self.assertEqual(int(registered[1, 0]), 0)

    def test_bridge_decodes_synchronized_rgbd_frame(self):
        depth = np.zeros((424, 512), dtype="<u2")
        depth[0, 0] = 1234
        coordinates = np.full((424, 512, 2), 65535, dtype="<u2")
        coordinates[0, 0] = [12, 34]
        jpeg = b"\xff\xd8test"
        payload = (
            struct.pack("<HHII", 512, 424, 456, len(jpeg))
            + depth.tobytes()
            + coordinates.tobytes()
            + jpeg
        )

        decoded_depth, decoded_coordinates, decoded_jpeg = kinect_seg.Bridge.decode_rgbd(payload)
        bridge = object.__new__(kinect_seg.Bridge)
        bridge.sock = Mock()
        bridge.read = Mock(side_effect=[
            (2, struct.pack("<HH", 256, 212)),
            (2, payload),
            socket.timeout(),
        ])
        newest_depth, newest_coordinates, newest_jpeg = bridge.newest_rgbd(0.1)

        self.assertEqual(float(decoded_depth[0, 0]), 1234)
        np.testing.assert_array_equal(decoded_coordinates[0, 0], [12, 34])
        self.assertEqual(decoded_jpeg, jpeg)
        np.testing.assert_array_equal(newest_depth, decoded_depth)
        np.testing.assert_array_equal(newest_coordinates, decoded_coordinates)
        self.assertEqual(newest_jpeg, jpeg)

    def test_rgbd_add_weights_registers_mask_and_predicts(self):
        y, x = np.indices((424, 512))
        depth = (1000 + (x - 256) ** 2 * 0.001 + (y - 212) ** 2 * 0.002).astype(np.float32)
        color_mask = np.zeros((540, 960), dtype=np.uint8)
        color_mask[100:132, 200:232] = 1
        depth_to_color = np.full((424, 512, 2), 65535, dtype=np.uint16)
        map_y, map_x = np.mgrid[180:212, 240:272]
        depth_to_color[180:212, 240:272, 0] = ((200 + map_x - 240) * 2).astype(np.uint16)
        depth_to_color[180:212, 240:272, 1] = ((100 + map_y - 180) * 2).astype(np.uint16)
        bird = {"polygon": []}
        model = Mock(available=True, rgbd_mode=True, typical_error_percent=None)
        model.predict.return_value = [654.0]

        with (
            patch.object(kinect_seg, "_weights", model),
            patch.object(kinect_seg, "_weight_intrinsics", {
                "fx": 365.0, "fy": 365.0, "cx": 255.0, "cy": 212.0,
            }),
        ):
            result = kinect_seg.add_weights(
                [bird], 960, 540, depth, depth_to_color, 1.0, [color_mask]
            )

        self.assertEqual(bird["weightG"], 650)
        self.assertEqual(result["weightStatus"], "ok")
        model.predict.assert_called_once()
        self.assertEqual(
            list(model.predict.call_args.args[0][0]),
            kinect_weight.RGBD_MODEL_FEATURES,
        )

    def test_rgbd_features_return_the_model_feature_order(self):
        y, x = np.indices((32, 32))
        depth = (900 + x * x + 2 * y * y).astype(np.float32)
        mask = np.zeros(depth.shape, dtype=np.uint8)
        mask[4:28, 4:28] = 1
        height_map = kinect_weight.background_subtract(depth, 1500)
        intrinsics = {"fx": 500.0, "fy": 500.0, "cx": 16.0, "cy": 16.0}

        features = kinect_weight.compute_rgbd_features(mask, depth, height_map, intrinsics)

        self.assertIsNotNone(features)
        self.assertEqual(list(features), kinect_weight.RGBD_MODEL_FEATURES)
        self.assertTrue(all(np.isfinite(value) for value in features.values()))


if __name__ == "__main__":
    unittest.main()
