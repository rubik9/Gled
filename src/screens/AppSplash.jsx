import { View, Image, StyleSheet, StatusBar } from "react-native";

export default function AppSplash() {
  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <Image
        source={require("../../assets/splash-icon.png")}
        style={styles.image}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff", // mismo color que tu splash nativo
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
