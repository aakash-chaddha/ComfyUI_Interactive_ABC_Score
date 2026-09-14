EXAMPLE_ABC = """X:1
T:ComfyUI Hornpipe
C:Traditional
M:C
L:1/8
Q:1/4=110
K:G
(3DEF GABd | g2 BG e2 cB | A2 AB cBAG | F2 AF D2 (3DEF |
G2 Gg g2 fg | a2 bg a2 gf | g2 fe d2 (3DEF | G2 BG D2 z2 |]
"""


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
