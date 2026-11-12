# (recipe mode) The prepared scene already holds the sky, and Cycles shows mirrors as they are: no sky dome, no light probe,
# no planar mirror probes. The shot keyframing below still moves a (stand-in) probe and reads an empty mirror list.
probe = bpy.data.objects.new("roomia_probe", None)
bpy.context.collection.objects.link(probe)
mirror_groups = []
mirror_probes = {}
def mirror_probe(g, sign):
    raise RuntimeError("no mirror probes in recipe mode")

