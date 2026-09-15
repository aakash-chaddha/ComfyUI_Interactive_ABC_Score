import pathlib

EXAMPLE_ABC = (pathlib.Path(__file__).parent / "input_sample.txt").read_text(encoding="utf-8")


class ABCScore:
    """Pure text carrier: emits whatever ABC text is effective, verbatim.

    Rendering, playback, and editing all live in the browser extension; the
    ui "text" echo is the authoritative mirror the editor adopts on execute.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "abc": ("STRING", {"multiline": True, "default": EXAMPLE_ABC, "dynamicPrompts": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("abc",)
    FUNCTION = "main"
    OUTPUT_NODE = True
    CATEGORY = "text"

    def main(self, abc):
        return {"ui": {"text": (abc,)}, "result": (abc,)}


NODE_CLASS_MAPPINGS = {"AbcScore": ABCScore}
NODE_DISPLAY_NAME_MAPPINGS = {"AbcScore": "ABC Score"}
